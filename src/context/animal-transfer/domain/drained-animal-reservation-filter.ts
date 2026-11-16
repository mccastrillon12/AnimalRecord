/** Shared by transfer capture and explicit maintenance reservations. DB time only. */
export function drainedAnimalReservationFilter(
  animalId: string,
  ownerId: string,
  ownershipVersion: number,
) {
  return {
    animalId,
    ownerId,
    ownershipVersion,
    transferLock: { $exists: false },
    'activeWrites.0': { $exists: false },
    $expr: {
      $lte: [
        { $ifNull: ['$uploadsValidUntil', ''] },
        {
          $dateToString: {
            date: '$$NOW',
            format: '%Y-%m-%dT%H:%M:%S.%LZ',
            timezone: 'UTC',
          },
        },
      ],
    },
  };
}
