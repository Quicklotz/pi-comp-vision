import { config } from '../config.js';
import { MarketplaceComp } from '../types/detection.js';

interface EnrichmentResult {
  title: string;
  brand?: string;
  model?: string;
  category?: string;
  description?: string;
  estimatedValue?: number;
  comps: MarketplaceComp[];
}

interface LookupResult {
  title?: string;
  brand?: string;
  model?: string;
  category?: string;
  upc?: string;
  asin?: string;
}

export class ProductEnrichment {
  async enrich(upc: string | null, asin: string | null, title: string | null): Promise<EnrichmentResult | null> {
    let productInfo: LookupResult | null = null;

    // Try UPC lookup first
    if (upc) {
      productInfo = await this.lookupUpc(upc);
    }

    // Try ASIN if no UPC result
    if (!productInfo && asin) {
      productInfo = await this.lookupAsin(asin);
    }

    if (!productInfo && !title) return null;

    const searchTitle = productInfo?.title || title || '';

    // Get marketplace comps
    const comps = await this.searchEbayComps(searchTitle);

    return {
      title: productInfo?.title || title || 'Unknown Product',
      brand: productInfo?.brand,
      model: productInfo?.model,
      category: productInfo?.category,
      description: undefined,
      estimatedValue: comps.length > 0
        ? comps.reduce((sum, c) => sum + c.price, 0) / comps.length
        : undefined,
      comps,
    };
  }

  async lookupUpc(upc: string): Promise<LookupResult | null> {
    if (!config.apis.upcItemDb) {
      // Try free tier (rate limited)
      try {
        const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`);
        if (!res.ok) return null;
        const data = await res.json() as any;
        const item = data.items?.[0];
        if (!item) return null;
        return {
          title: item.title,
          brand: item.brand,
          category: item.category,
          upc,
        };
      } catch {
        return null;
      }
    }

    try {
      const res = await fetch(`https://api.upcitemdb.com/prod/v1/lookup?upc=${encodeURIComponent(upc)}`, {
        headers: {
          'Content-Type': 'application/json',
          'user_key': config.apis.upcItemDb,
        },
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      const item = data.items?.[0];
      if (!item) return null;
      return {
        title: item.title,
        brand: item.brand,
        category: item.category,
        upc,
      };
    } catch {
      return null;
    }
  }

  async lookupAsin(asin: string): Promise<LookupResult | null> {
    // Amazon SP-API catalog lookup
    if (!config.apis.amazon.clientId) {
      console.warn('[Enrichment] Amazon SP-API not configured');
      return null;
    }

    try {
      const token = await this.getAmazonAccessToken();
      if (!token) return null;

      const res = await fetch(
        `https://sellingpartnerapi-na.amazon.com/catalog/2022-04-01/items/${asin}?marketplaceIds=ATVPDKIKX0DER&includedData=summaries,attributes`,
        {
          headers: {
            'x-amz-access-token': token,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!res.ok) return null;
      const data = await res.json() as any;
      const summary = data.summaries?.[0];

      return {
        title: summary?.itemName,
        brand: summary?.brand,
        category: summary?.productType,
        asin,
      };
    } catch (err) {
      console.error('[Enrichment] Amazon lookup error:', err);
      return null;
    }
  }

  async lookupFnsku(fnsku: string): Promise<LookupResult | null> {
    // FNSKU → ASIN mapping via Amazon SP-API FBA inventory
    if (!config.apis.amazon.clientId) return null;

    try {
      // Try to find ASIN via FBA inventory report
      // This is a simplified version — full implementation would use Reports API
      console.warn('[Enrichment] FNSKU lookup requires Reports API — not yet implemented');
      return null;
    } catch {
      return null;
    }
  }

  private async getAmazonAccessToken(): Promise<string | null> {
    try {
      const res = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: config.apis.amazon.refreshToken,
          client_id: config.apis.amazon.clientId,
          client_secret: config.apis.amazon.clientSecret,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      return data.access_token;
    } catch {
      return null;
    }
  }

  private async searchEbayComps(query: string): Promise<MarketplaceComp[]> {
    if (!config.apis.ebay.appId || !query) return [];

    try {
      const token = await this.getEbayAccessToken();
      if (!token) return [];

      const params = new URLSearchParams({
        q: query,
        filter: 'buyingOptions:{FIXED_PRICE|AUCTION},conditionIds:{1000|1500|2000|2500|3000}',
        sort: 'price',
        limit: '10',
      });

      const res = await fetch(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!res.ok) return [];
      const data = await res.json() as any;

      return (data.itemSummaries || []).slice(0, 5).map((item: any) => ({
        source: 'ebay' as const,
        title: item.title,
        price: parseFloat(item.price?.value || '0'),
        url: item.itemWebUrl,
        condition: item.condition || 'Unknown',
      }));
    } catch (err) {
      console.error('[Enrichment] eBay search error:', err);
      return [];
    }
  }

  private async getEbayAccessToken(): Promise<string | null> {
    try {
      const credentials = Buffer.from(
        `${config.apis.ebay.appId}:${config.apis.ebay.certId}`
      ).toString('base64');

      const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
      });

      if (!res.ok) return null;
      const data = await res.json() as any;
      return data.access_token;
    } catch {
      return null;
    }
  }
}
