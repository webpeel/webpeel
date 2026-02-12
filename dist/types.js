/**
 * Core types for WebPeel
 */
export class WebPeelError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'WebPeelError';
    }
}
export class TimeoutError extends WebPeelError {
    constructor(message) {
        super(message, 'TIMEOUT');
        this.name = 'TimeoutError';
    }
}
export class BlockedError extends WebPeelError {
    constructor(message) {
        super(message, 'BLOCKED');
        this.name = 'BlockedError';
    }
}
export class NetworkError extends WebPeelError {
    constructor(message) {
        super(message, 'NETWORK');
        this.name = 'NetworkError';
    }
}
//# sourceMappingURL=types.js.map