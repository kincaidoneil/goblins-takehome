/**
 * Where launch hands off: the teacher's dashboard and the projector window, owned by the
 * Dashboard + projector stream.
 */
export const dashboardPath = (sessionId: string) => `/teach/${sessionId}`;
export const projectorPath = (sessionId: string) => `/projector/${sessionId}`;
