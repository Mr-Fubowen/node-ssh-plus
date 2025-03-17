class SSHClientError extends Error {
    constructor(error) {
        super(error.message)
        this.name = this.constructor.name
        this.internalError = error
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor)
        }
    }
}

class ReconnectError extends SSHClientError {
    constructor(error) {
        super(error)
    }
}

class MaxRetriesExceededError extends SSHClientError {
    constructor(error) {
        super(error)
    }
}

class ConnectError extends SSHClientError {
    constructor(error) {
        super(error)
    }
}

module.exports = {
    ReconnectError,
    MaxRetriesExceededError,
    ConnectError
}
