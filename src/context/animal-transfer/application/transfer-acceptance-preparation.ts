import { Inject, Injectable } from '@nestjs/common';
import {
  AcceptancePreparationStore,
  AcceptanceSelection,
  acceptanceSelection,
  buildAcceptanceCandidate,
} from '../domain/transfer-acceptance-preparation';

/** Internal observer only. No operational caller, HTTP acceptance or lock acquisition. */
@Injectable()
export class TransferAcceptancePreparation {
  constructor(
    @Inject('AcceptancePreparationStore')
    private readonly store: AcceptancePreparationStore,
  ) {}
  prepare(raw: AcceptanceSelection) {
    const input = acceptanceSelection(raw);
    return this.store.snapshot(input, (snapshot) =>
      buildAcceptanceCandidate(input, snapshot, new Date().toISOString()),
    );
  }
}
