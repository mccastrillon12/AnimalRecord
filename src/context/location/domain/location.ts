export class Country {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly isoCode: string,
        public readonly dialCode: string
    ) { }
}

export class Department {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly countryId: string
    ) { }
}

export class City {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly departmentId: string
    ) { }
}
