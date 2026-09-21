// Shared with node tests; no shell imports or independent recording state.
export function presentation(state) {
    if (!state || state.version !== 1 || typeof state.token !== 'string')
        throw new Error('Unsupported VOCO panel state');
    const labels = {idle: '', initializing: 'Starting VOCO', starting: 'Starting', recording: 'Listening',
        processing: 'Finishing', recovery: 'Review', attention: 'Check setup'};
    if (!Object.hasOwn(labels, state.status)) throw new Error('Unknown VOCO state');
    return {
        ...state,
        label: labels[state.status],
        active: ['starting', 'recording', 'processing'].includes(state.status),
        canStop: state.canStop === true && ['starting', 'recording'].includes(state.status),
        canOpen: state.canOpen === true && !['starting', 'recording', 'processing'].includes(state.status),
        level: state.status === 'recording' && Number.isFinite(state.level)
            ? Math.max(0, Math.min(1, state.level)) : 0,
    };
}
export function barScales(level) {
    return [0.35, 0.65, 0.9, 1, 0.8, 0.55, 0.3].map(weight => 0.15 + 0.85 * level * weight);
}
