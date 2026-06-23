export class AssetsCacheManager {
  constructor(ttl = 60000) {
    this.ttl = ttl;
    this.cache = new Map();
  }

  async get(key, loader) {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.ttl) {
      return cached.data;
    }

    const data = await loader();
    this.cache.set(key, { timestamp: now, data });
    return data;
  }
}
