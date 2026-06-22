import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReviewResult } from "./review-result.mjs";

export {
  isBlockingFinding,
  normalizeReviewResult,
  validateRawResult,
} from "./review-result.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);

export async function loadReviewerAssets() {
  const [systemPrompt, schemaText, providersText] = await Promise.all([
    fs.readFile(path.join(skillDir, "references", "reviewer-prompt.md"), "utf8"),
    fs.readFile(path.join(skillDir, "references", "review-result.schema.json"), "utf8"),
    fs.readFile(path.join(skillDir, "references", "model-providers.json"), "utf8"),
  ]);

  return {
    systemPrompt,
    schema: JSON.parse(schemaText),
    providersConfig: JSON.parse(providersText),
  };
}

export async function loadEnvFile(root, fileName = ".env") {
  const envPath = path.join(root, fileName);
  let content;
  try {
    content = await fs.readFile(envPath, "utf8");
  } catch {
    return false;
  }

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const { key, value } = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return true;
}

export function resolveProviderOptions(options = {}, providersConfig = loadFallbackProvidersConfig()) {
  const usePrimaryEnv = options.usePrimaryEnv !== false;
  const requestedModel = options.model || (usePrimaryEnv ? process.env.AI_REVIEW_PRIMARY_MODEL : undefined);
  const providerName =
    options.provider ||
    (usePrimaryEnv ? process.env.AI_REVIEW_PRIMARY_PROVIDER : undefined) ||
    inferProviderFromModel(requestedModel, providersConfig) ||
    providersConfig.defaultProvider ||
    "deepseek";
  const provider = resolveProvider(providerName, providersConfig);
  const providerConfig = provider.config;
  const model =
    requestedModel ||
    providerConfig.model;
  const apiStyle =
    options.apiStyle ||
    (usePrimaryEnv ? process.env.AI_REVIEW_API_STYLE : undefined) ||
    providerConfig.apiStyle ||
    "chat";
  const transport =
    options.transport ||
    (usePrimaryEnv ? process.env.AI_REVIEW_TRANSPORT : undefined) ||
    providerConfig.transport ||
    (apiStyle === "responses" ? "responses" : "openai-compatible");
  const baseUrl =
    options.baseUrl ||
    (usePrimaryEnv ? process.env.AI_REVIEW_PRIMARY_BASE_URL : undefined) ||
    firstEnvValue(providerScopedEnvNames(providerConfig.baseUrlEnv)) ||
    providerConfig.baseUrl;
  const cliCommand =
    options.cliCommand ||
    (usePrimaryEnv ? process.env.AI_REVIEW_CLI_COMMAND : undefined) ||
    firstEnvValue(providerScopedEnvNames(providerConfig.commandEnv)) ||
    providerConfig.command;
  const apiKey =
    options.apiKey ||
    (usePrimaryEnv ? process.env.AI_REVIEW_PRIMARY_API_KEY : undefined) ||
    firstEnvValue(providerScopedEnvNames(providerConfig.apiKeyEnv));
  const timeoutMs = positiveNumber(
    options.timeoutMs,
    process.env.AI_REVIEW_TIMEOUT_MS,
    providerConfig.timeoutMs,
    120000,
  );
  const retries = nonNegativeNumber(
    options.retries,
    process.env.AI_REVIEW_RETRIES,
    providerConfig.retries,
    1,
  );

  if (transport !== "cli" && !baseUrl) {
    throw new Error(`Missing base URL for provider "${provider.name}".`);
  }

  return {
    provider: provider.name,
    requestedProvider: providerName,
    transport,
    model,
    apiStyle,
    baseUrl: baseUrl ? baseUrl.replace(/\/$/, "") : "",
    apiKey,
    cliCommand,
    reasoningEffort: process.env.AI_REVIEW_REASONING_EFFORT || "high",
    responseFormat: process.env.AI_REVIEW_RESPONSE_FORMAT || providerConfig.responseFormat || "json_object",
    requestOptions: providerConfig.requestOptions || {},
    strictSchema: booleanValue(process.env.AI_REVIEW_STRICT_SCHEMA, providerConfig.strictSchema, true),
    strictOutput: booleanValue(process.env.AI_REVIEW_STRICT_OUTPUT, providerConfig.strictOutput, false),
    timeoutMs,
    retries,
  };
}

function providerScopedEnvNames(names = []) {
  return names.filter((name) => !name.startsWith("AI_REVIEW_"));
}

function inferProviderFromModel(model, providersConfig) {
  const normalized = String(model || "").trim().toLowerCase();
  if (!normalized) return "";

  for (const [name, config] of Object.entries(providersConfig.providers || {})) {
    const candidates = [
      name,
      config.model,
      ...(config.aliases || []),
      ...(config.models || []),
      ...(config.modelAliases || []),
    ];
    if (candidates.some((candidate) => String(candidate || "").toLowerCase() === normalized)) {
      return name;
    }
  }
  return "";
}

export async function callReviewModel({ brief, systemPrompt, schema, options, providersConfig }) {
  const providerOptions = resolveProviderOptions(options, providersConfig || await loadProvidersConfig());
  if (providerOptions.transport === "cli") {
    return callCliReviewer({ brief, systemPrompt, schema, providerOptions });
  }

  if (!providerOptions.apiKey) {
    throw new Error(`Missing API key for provider "${providerOptions.provider}". See references/provider-config.md.`);
  }

  if (providerOptions.transport === "responses" || providerOptions.apiStyle === "responses") {
    return callResponsesApi({ brief, systemPrompt, schema, providerOptions });
  }

  return callChatCompletionsApi({ brief, systemPrompt, schema, providerOptions });
}

async function callChatCompletionsApi({ brief, systemPrompt, schema, providerOptions }) {
  const reviewerSchema = toReviewerSchema(schema);
  const body = {
    model: providerOptions.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: renderUserContent(brief, reviewerSchema) },
    ],
    temperature: 0,
  };

  if (providerOptions.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  if (providerOptions.requestOptions.thinking && process.env.AI_REVIEW_THINKING_TYPE !== "disabled") {
    body.thinking = {
      ...providerOptions.requestOptions.thinking,
      type: process.env.AI_REVIEW_THINKING_TYPE || providerOptions.requestOptions.thinking.type,
    };
  }

  const useStreaming = booleanValue(process.env.AI_REVIEW_STREAMING, false);
  if (useStreaming) {
    body.stream = true;
  }

  const payload = await fetchJsonWithRetry(`${providerOptions.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerOptions.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, providerOptions, useStreaming);

  const content = useStreaming
    ? extractStreamContent(payload)
    : payload.choices?.[0]?.message?.content;

  return parseReviewResult(content, { strict: providerOptions.strictOutput });
}

async function callResponsesApi({ brief, systemPrompt, schema, providerOptions }) {
  const reviewerSchema = toReviewerSchema(schema);
  const payload = await fetchJsonWithRetry(`${providerOptions.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerOptions.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: providerOptions.model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: brief },
      ],
      reasoning: { effort: providerOptions.reasoningEffort },
      text: {
        format: {
          type: "json_schema",
          name: "review_result",
          schema: reviewerSchema,
          strict: providerOptions.strictSchema,
        },
      },
    }),
  }, providerOptions);

  const content =
    payload.output_text ||
    payload.output
      ?.flatMap((item) => item.content || [])
      .map((item) => item.text || "")
      .join("\n");

  return parseReviewResult(content, { strict: providerOptions.strictOutput });
}

async function callCliReviewer({ brief, systemPrompt, schema, providerOptions }) {
  if (!providerOptions.cliCommand) {
    throw new Error(`Missing CLI command for provider "${providerOptions.provider}".`);
  }

  const input = renderCliInput(brief, systemPrompt, toReviewerSchema(schema));
  const { stdout, stderr } = await runCliCommand(providerOptions.cliCommand, input, providerOptions.timeoutMs);
  const content = stdout.trim() || stderr.trim();
  return parseReviewResult(content, { strict: providerOptions.strictOutput });
}

function toReviewerSchema(schema) {
  const reviewerSchema = JSON.parse(JSON.stringify(schema));
  delete reviewerSchema.properties?.verdict_label;
  delete reviewerSchema.properties?.reviewer_failures;
  delete reviewerSchema.$defs?.finding?.properties?.sources;
  return reviewerSchema;
}

function renderCliInput(brief, systemPrompt, schema) {
  return `${systemPrompt}

${brief}

## Required JSON Schema

Return exactly one JSON object that conforms to this schema:

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`
`;
}

function runCliCommand(command, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(annotateReviewError(new Error(`CLI reviewer timed out after ${timeoutMs}ms.`), {
        timeoutMs,
        attempts: 1,
        source: "cli",
      }));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (error?.code === "ENOENT") {
        reject(annotateReviewError(new Error(`CLI reviewer command was not found: ${command}`), {
          source: "cli",
          attempts: 1,
        }));
        return;
      }
      reject(annotateReviewError(error, { source: "cli", attempts: 1 }));
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (exitCode !== 0) {
        reject(annotateReviewError(new Error(`CLI reviewer failed (${exitCode}): ${stderr || stdout}`), {
          source: "cli",
          attempts: 1,
          exitCode,
        }));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function renderUserContent(brief, schema) {
  return `${brief}

## Required JSON Schema

Return exactly one JSON object that conforms to this schema:

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`
`;
}

async function fetchJsonWithRetry(url, requestOptions, providerOptions, streaming = false) {
  let lastError;
  const attempts = providerOptions.retries + 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), providerOptions.timeoutMs);
    try {
      const response = await fetch(url, {
        ...requestOptions,
        signal: controller.signal,
      });
      if (streaming) {
        return await readStreamResponse(response);
      }
      return await readJsonResponse(response);
    } catch (error) {
      lastError = error;
      annotateReviewError(error, {
        attempts: attempt,
        timeoutMs: providerOptions.timeoutMs,
      });
      if (attempt >= attempts || !isRetryableModelError(error)) {
        throw error;
      }
      const waitMs = Math.min(1000 * 2 ** (attempt - 1), 5000);
      process.stderr.write(
        `Model request retry ${attempt}/${attempts - 1} after ${error.message}; waiting ${waitMs}ms\n`,
      );
      await delay(waitMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function readJsonResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Model request failed (${response.status}): ${JSON.stringify(payload).slice(0, 1200)}`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function readStreamResponse(response) {
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Model request failed (${response.status}): ${text.slice(0, 1200)}`);
    error.status = response.status;
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const chunks = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        processStreamLine(buffer.trim(), chunks);
      }
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      processStreamLine(line.trim(), chunks);
    }
  }

  return { streamChunks: chunks };
}

function processStreamLine(line, chunks) {
  if (!line || !line.startsWith("data: ")) return;
  const data = line.slice(6);
  if (data === "[DONE]") return;
  try {
    const parsed = JSON.parse(data);
    const content = parsed.choices?.[0]?.delta?.content;
    if (content) chunks.push(content);
  } catch {
    // skip unparseable SSE lines
  }
}

function extractStreamContent(payload) {
  return (payload.streamChunks || []).join("");
}

function isRetryableModelError(error) {
  if (error?.name === "AbortError") return true;
  if (typeof error?.status === "number") {
    return error.status === 429 || error.status >= 500;
  }
  return false;
}

export function classifyReviewError(error = {}) {
  const message = String(error?.message || error || "unknown error");
  const status = typeof error?.status === "number" ? error.status : null;
  const source = String(error?.source || "");
  const code = String(error?.code || "");
  const category = reviewErrorCategory({ error, message, status, source, code });

  return {
    category,
    retryable: retryableReviewError(category, status),
    message,
    status,
    attempts: normalizePositiveInteger(error?.attempts),
  };
}

function annotateReviewError(error, metadata = {}) {
  if (error && typeof error === "object") {
    for (const [key, value] of Object.entries(metadata)) {
      if (value === undefined) continue;
      if (["attempts", "timeoutMs"].includes(key) || error[key] === undefined) {
        error[key] = value;
      }
    }
  }
  return error;
}

function reviewErrorCategory({ error, message, status, source, code }) {
  const normalized = message.toLowerCase();
  if (error?.name === "AbortError" || /timed?\s*out|timeout|aborted/.test(normalized)) return "timeout";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (typeof status === "number" && status >= 500) return "server";
  if (/missing api key|missing base url|unknown provider|missing cli command|command was not found/.test(normalized)) return "config";
  if (/reviewer response did not contain valid json|reviewer returned an empty response|schema errors?/.test(normalized)) return "bad_response";
  if (source === "cli" || /cli reviewer/.test(normalized)) return "cli";
  if (
    error instanceof TypeError ||
    /fetch failed|network|econnreset|enotfound|etimedout|eai_again|socket hang up/.test(normalized) ||
    ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"].includes(code)
  ) {
    return "network";
  }
  return "unknown";
}

function retryableReviewError(category, status) {
  if (["timeout", "network", "rate_limit", "server"].includes(category)) return true;
  return typeof status === "number" && (status === 429 || status >= 500);
}

function normalizePositiveInteger(value) {
  return Number.isInteger(value) && value >= 1 ? value : null;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const equalsIndex = normalized.indexOf("=");
  if (equalsIndex <= 0) return null;

  const key = normalized.slice(0, equalsIndex).trim();
  let value = normalized.slice(equalsIndex + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

async function loadProvidersConfig() {
  const configPath = path.join(skillDir, "references", "model-providers.json");
  return JSON.parse(await fs.readFile(configPath, "utf8"));
}

function loadFallbackProvidersConfig() {
  return {
    defaultProvider: "deepseek",
    providers: {
      deepseek: {
        model: "deepseek-v4-pro",
        transport: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        apiStyle: "chat",
        apiKeyEnv: ["DEEPSEEK_API_KEY"],
        responseFormat: "json_object",
      },
    },
  };
}

function resolveProvider(providerName, providersConfig) {
  const providers = providersConfig.providers || {};
  if (providers[providerName]) {
    return { name: providerName, config: providers[providerName] };
  }

  for (const [name, config] of Object.entries(providers)) {
    if ((config.aliases || []).includes(providerName)) {
      return { name, config };
    }
  }

  throw new Error(`Unknown provider "${providerName}". Add it to references/model-providers.json.`);
}

function firstEnvValue(names = []) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return "";
}

function positiveNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function nonNegativeNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return 0;
}

function booleanValue(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "enabled"].includes(normalized)) return true;
      if (["false", "0", "no", "disabled"].includes(normalized)) return false;
    }
  }
  return true;
}
