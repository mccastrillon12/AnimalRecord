export type AnimalFilters = {
    species?: string;
    sex?: string;
    minAgeMonths?: number;
    maxAgeMonths?: number;
    dateFrom?: string;     // ISO string
    dateTo?: string;       // ISO string
    ownerId?: string;
    isActive?: boolean;
};
