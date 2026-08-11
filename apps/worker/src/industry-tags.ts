/**
 * ICP industry keyword -> OSM tag/value and Yelp category, for the two
 * sources that need a place-type vocabulary instead of free text. Coverage is
 * intentionally small and physical-business-oriented (Overpass and Yelp both
 * only know about place-based businesses) — an ICP industry with no match
 * here just gets skipped for that one source, not guessed at.
 */
export interface IndustryTag {
  osmTag: string;
  osmValue: string;
  yelpCategory: string;
}

const TABLE: Record<string, IndustryTag> = {
  restaurant: { osmTag: "amenity", osmValue: "restaurant", yelpCategory: "restaurants" },
  cafe: { osmTag: "amenity", osmValue: "cafe", yelpCategory: "coffee" },
  dentist: { osmTag: "amenity", osmValue: "dentist", yelpCategory: "dentists" },
  doctor: { osmTag: "amenity", osmValue: "doctors", yelpCategory: "physicians" },
  clinic: { osmTag: "amenity", osmValue: "clinic", yelpCategory: "physicians" },
  gym: { osmTag: "leisure", osmValue: "fitness_centre", yelpCategory: "gyms" },
  salon: { osmTag: "shop", osmValue: "hairdresser", yelpCategory: "hairsalons" },
  spa: { osmTag: "shop", osmValue: "beauty", yelpCategory: "spas" },
  hotel: { osmTag: "tourism", osmValue: "hotel", yelpCategory: "hotels" },
  lawyer: { osmTag: "office", osmValue: "lawyer", yelpCategory: "lawyers" },
  "law firm": { osmTag: "office", osmValue: "lawyer", yelpCategory: "lawyers" },
  accountant: { osmTag: "office", osmValue: "accountant", yelpCategory: "accountants" },
  accounting: { osmTag: "office", osmValue: "accountant", yelpCategory: "accountants" },
  "real estate": { osmTag: "office", osmValue: "estate_agent", yelpCategory: "realestateagents" },
  "auto repair": { osmTag: "shop", osmValue: "car_repair", yelpCategory: "autorepair" },
  pharmacy: { osmTag: "amenity", osmValue: "pharmacy", yelpCategory: "pharmacy" },
  retail: { osmTag: "shop", osmValue: "yes", yelpCategory: "shopping" },
  bakery: { osmTag: "shop", osmValue: "bakery", yelpCategory: "bakeries" },
  veterinary: { osmTag: "amenity", osmValue: "veterinary", yelpCategory: "veterinarians" },
  "vet clinic": { osmTag: "amenity", osmValue: "veterinary", yelpCategory: "veterinarians" },
  bank: { osmTag: "amenity", osmValue: "bank", yelpCategory: "banks" },
  insurance: { osmTag: "office", osmValue: "insurance", yelpCategory: "insurance" },
  "car dealer": { osmTag: "shop", osmValue: "car", yelpCategory: "cardealers" },
  "co-working": { osmTag: "office", osmValue: "coworking", yelpCategory: "coworkingspaces" },
  coworking: { osmTag: "office", osmValue: "coworking", yelpCategory: "coworkingspaces" },
};

/** First ICP industry with a known mapping, or `null` if none of them have one. */
export function matchIndustryTag(industries: string[]): IndustryTag | null {
  for (const industry of industries) {
    const hit = TABLE[industry.trim().toLowerCase()];
    if (hit) return hit;
  }
  return null;
}
