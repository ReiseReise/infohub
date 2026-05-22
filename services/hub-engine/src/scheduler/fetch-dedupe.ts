const IN_FLIGHT_FETCH_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized']);

export function isFetchJobInFlight(state: string): boolean {
  return IN_FLIGHT_FETCH_STATES.has(state);
}

export function shouldRemoveExistingFetchJob(state: string): boolean {
  return !isFetchJobInFlight(state);
}
