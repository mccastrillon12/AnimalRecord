import { Inject, Injectable } from '@nestjs/common';
import {
  AcceptanceSelection,
  acceptanceSelection,
} from '../domain/transfer-acceptance-preparation';
import { AcceptanceStartStore } from '../domain/transfer-acceptance-start';

/** Explicit internal start. No HTTP route, S3 dispatch or ownership commit. */
@Injectable()
export class TransferAcceptanceStart {
  constructor(
    @Inject('AcceptanceStartStore')
    private readonly store: AcceptanceStartStore,
  ) {}
  start(raw: AcceptanceSelection) {
    return this.store.start(acceptanceSelection(raw));
  }
}
