import type { NotificationRecord } from '../../notification/domain/notification';
import type { TransferRequestRecord } from './transfer-request';
import { transferRecordId } from './transfer-record-id';

type NoticeRequest = Pick<
  TransferRequestRecord,
  '_id' | 'senderId' | 'recipientId'
> &
  Partial<Pick<TransferRequestRecord, 'senderName' | 'recipientName'>>;

export function transferDecisionNotices(
  request: NoticeRequest,
  operationId: string,
  at: string,
  accepted: readonly string[],
  rejected: readonly string[],
): NotificationRecord[] {
  const sender = request.senderName?.trim() || 'el remitente';
  const recipient = request.recipientName?.trim() || 'El destinatario';
  const notice = (
    userId: string,
    type: NotificationRecord['type'],
    itemIds: readonly string[],
    title: string,
    text: string,
  ): NotificationRecord => ({
    _id: transferRecordId(
      'decision-notice',
      request._id,
      `${operationId}/${userId}/${type}`,
    ),
    userId,
    transferId: request._id,
    type,
    itemIds: [...itemIds],
    title,
    text,
    createdAt: at,
  });

  const notices: NotificationRecord[] = [];
  if (accepted.length && rejected.length) {
    notices.push(
      notice(
        request.senderId,
        'ANIMAL_TRANSFER_MIXED_RESULT',
        [...accepted, ...rejected],
        `${recipient} aceptó ${accepted.length} de ${accepted.length + rejected.length} animales.`,
        'Los animales rechazados permanecen en «Mis animales».',
      ),
    );
  } else if (accepted.length) {
    notices.push(
      notice(
        request.senderId,
        'ANIMAL_TRANSFER_ACCEPTED',
        accepted,
        `${recipient} ha aceptado la transferencia.`,
        `Se completó el traspaso de ${animalCount(accepted.length)}.`,
      ),
    );
  } else {
    notices.push(
      notice(
        request.senderId,
        'ANIMAL_TRANSFER_REJECTED',
        rejected,
        `${recipient} ha rechazado la transferencia de ${animalCount(rejected.length)}.`,
        'Puedes consultar los animales en «Mis animales».',
      ),
    );
  }
  if (accepted.length)
    notices.push(
      notice(
        request.recipientId,
        'ANIMAL_TRANSFER_RECIPIENT_ACCEPTED',
        accepted,
        `Aceptaste la transferencia de ${animalCount(accepted.length)} de ${sender}.`,
        'Consulta los animales en «Mis animales».',
      ),
    );
  if (rejected.length)
    notices.push(
      notice(
        request.recipientId,
        'ANIMAL_TRANSFER_RECIPIENT_REJECTED',
        rejected,
        `Rechazaste la transferencia de ${animalCount(rejected.length)} de ${sender}.`,
        'Tu respuesta quedó registrada.',
      ),
    );
  return notices;
}

export function animalCount(count: number): string {
  return count === 1 ? '1 animal' : `${count} animales`;
}
