export interface ISmsSender {
    send(phoneNumber: string, message: string): Promise<void>;
}
