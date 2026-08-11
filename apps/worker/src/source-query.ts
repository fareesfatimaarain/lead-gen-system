import type { Icp } from "@outreach/db";
import type { SourceQuery } from "@outreach/adapters";
import { geocode } from "./geocode";
import { matchIndustryTag } from "./industry-tags";

export type BuiltQuery = { query: SourceQuery } | { skip: string };

const US_STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

function stateAbbr(region: string | undefined): string | null {
  if (!region) return null;
  const trimmed = region.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return US_STATE_ABBR[trimmed.toLowerCase()] ?? null;
}

function isUS(country: string | undefined): boolean {
  const c = (country ?? "").trim().toLowerCase();
  return c === "united states" || c === "usa" || c === "us" || c === "united states of america";
}

function placeName(geo: { city?: string; region?: string; country?: string }): string {
  return [geo.city, geo.region, geo.country].filter(Boolean).join(", ");
}

export async function buildSourceQuery(providerId: string, icp: Pick<Icp, "industries" | "titles" | "geographies">, limit: number): Promise<BuiltQuery> {
  const geo = icp.geographies[0];

  switch (providerId) {
    case "overpass": {
      if (!geo) return { skip: "ICP has no geography set." };
      const tag = matchIndustryTag(icp.industries);
      if (!tag) return { skip: `No OSM category mapping for any of this ICP's industries (${icp.industries.join(", ") || "none set"}).` };
      const box = await geocode(placeName(geo));
      if (!box) return { skip: `Could not geocode "${placeName(geo)}".` };
      return {
        query: {
          query: tag.osmValue,
          limit,
          filters: { tag: tag.osmTag, value: tag.osmValue, bbox: [box.south, box.west, box.north, box.east] },
        },
      };
    }

    case "google_places": {
      if (!geo) return { skip: "ICP has no geography set." };
      const term = icp.industries[0] ?? icp.titles[0];
      if (!term) return { skip: "ICP has no industry or title to search for." };
      const box = await geocode(placeName(geo));
      return {
        query: {
          query: `${term} in ${placeName(geo)}`,
          limit,
          filters: box ? { locationBias: { south: box.south, west: box.west, north: box.north, east: box.east } } : {},
        },
      };
    }

    case "yelp": {
      if (!geo?.city) return { skip: "ICP has no city set — Yelp requires one." };
      const term = icp.industries[0] ?? "";
      const tag = matchIndustryTag(icp.industries);
      return {
        query: {
          query: term,
          limit,
          filters: { location: placeName(geo), ...(tag ? { categories: tag.yelpCategory } : {}) },
        },
      };
    }

    case "sec_edgar": {
      const term = icp.industries[0] ?? icp.titles[0];
      if (!term) return { skip: "ICP has no industry or title to search for." };
      return { query: { query: term, limit } };
    }

    case "apollo": {
      if (icp.titles.length === 0) return { skip: "ICP has no target titles set." };
      return {
        query: {
          query: icp.titles[0]!,
          limit,
          filters: {
            titles: icp.titles,
            locations: icp.geographies.map(placeName).filter(Boolean),
          },
        },
      };
    }

    case "rentcast": {
      if (!geo || !isUS(geo.country)) return { skip: "RentCast only covers the US — ICP has no US geography set." };
      const state = stateAbbr(geo.region);
      if (!geo.city || !state) return { skip: "RentCast needs a US city and state — add both to the ICP's geography." };
      return { query: { query: `${geo.city}, ${state}`, limit, filters: { city: geo.city, state } } };
    }

    default:
      return { skip: `No query builder for provider "${providerId}" yet.` };
  }
}
