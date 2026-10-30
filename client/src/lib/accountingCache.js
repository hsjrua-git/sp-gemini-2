// Every successful journal-affecting write must invalidate the actual consumer
// keys, including cached date/account variants that are not currently mounted.
const JOURNAL_QUERY_FAMILIES = [
  'accounting-journal',
  'accounting-trial-balance',
  'accounting-income',
  'accounting-balance-sheet',
  'accounting-ledger',
];

export function invalidateAccounting(queryClient) {
  return Promise.all(JOURNAL_QUERY_FAMILIES.map((key) =>
    queryClient.invalidateQueries({ queryKey: [key] })
  ));
}
