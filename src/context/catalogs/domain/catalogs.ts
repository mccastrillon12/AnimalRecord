export class Species {
    constructor(
        public readonly id: string,
        public readonly name: string
    ) { }
}

export class Breed {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly speciesId: string
    ) { }
}

export class HousingType {
    constructor(
        public readonly id: string,
        public readonly name: string
    ) { }
}

export class AnimalPurpose {
    constructor(
        public readonly id: string,
        public readonly name: string
    ) { }
}

export class Temperament {
    constructor(
        public readonly id: string,
        public readonly name: string
    ) { }
}
