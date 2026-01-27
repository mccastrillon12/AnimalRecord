export interface ITokenGenerator {
    generate(payload: any): string;
    generateRefresh(payload: any): string;
    generatePreAuth(payload: any): string;
}
