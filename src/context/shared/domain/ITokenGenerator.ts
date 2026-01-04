export interface ITokenGenerator {
    generate(payload: any): string;
    generateRefresh(payload: any): string;
}
