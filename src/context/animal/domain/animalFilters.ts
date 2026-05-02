export type AgeRange = {
    min: number;  // months
    max: number;  // months
};

export type AnimalFilters = {
    species?: string[];     // multiple species (OR)
    sex?: string[];         // multiple sex values (OR)
    ageRanges?: AgeRange[]; // multiple age ranges (OR), includes approxAge overlap
    dateFrom?: string;      // ISO string
    dateTo?: string;        // ISO string
    ownerId?: string;
    isActive?: boolean;
};
