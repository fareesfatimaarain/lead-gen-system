/**
 * Free-text place name to bounding box, via the public Nominatim API.
 *
 * Used only to turn an ICP's plain-text geography ("Austin, Texas") into the
 * bounding box Overpass needs — never called in a loop over many places, and
 * the result is memoized per process so a run that touches the same geography
 * twice does not repeat the request.
 *
 * Usage policy (operations.osmfoundation.org/policies/nominatim/): max 1
 * request/second, a real identifying User-Agent, no bulk/systematic querying,
 * cache repeated queries. All four are honored below — one geocode per
 * distinct place per worker process lifetime, a fixed User-Agent, and no
 * concurrent requests (discovery runs geocode sequentially, not in parallel).
 *
 * Endpoint and field names confirmed against nominatim.org/release-docs.
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "outreach-system/1.0 (self-hosted outbound tool; see project README)";

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const cache = new Map<string, Promise<BoundingBox | null>>();
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  const wait = Math.max(0, 1100 - elapsed);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

interface NominatimResult {
  boundingbox?: [string, string, string, string]; // [south, north, west, east]
}

export function geocode(place: string): Promise<BoundingBox | null> {
  const key = place.trim().toLowerCase();
  if (!key) return Promise.resolve(null);

  const cached = cache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    await throttle();
    const url = new URL(NOMINATIM_BASE);
    url.searchParams.set("q", place);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");

    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) return null;

    const results = (await response.json()) as NominatimResult[];
    const box = results[0]?.boundingbox;
    if (!box) return null;

    const [south, north, west, east] = box.map(Number);
    if ([south, north, west, east].some((n) => !Number.isFinite(n))) return null;
    return { south: south!, west: west!, north: north!, east: east! };
  })();

  cache.set(key, promise);
  return promise;
}
