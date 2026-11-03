export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Please sign in to continue.') {
    super(401, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'You do not have permission to do that.') {
    super(403, message);
  }
}

export class OtpError extends HttpError {
  constructor(message = 'That code is not valid. Request a new one.') {
    super(400, message);
  }
}

export class OtpCooldownError extends HttpError {
  constructor(message = 'Please wait a minute before requesting another code.') {
    super(429, message);
  }
}

export class LockedError extends HttpError {
  constructor(message = 'Too many attempts. Try again in a few minutes.') {
    super(429, message);
  }
}

export class DuplicateNameError extends HttpError {
  constructor(message = 'That name is already in use.') {
    super(409, message);
  }
}

export class DuplicateMasterError extends HttpError {
  constructor() {
    super(409, 'A master user already exists. Refusing to create another.');
  }
}

export class EmailUnavailableError extends HttpError {
  constructor(message = 'We could not send the email. Check the email settings and try again.') {
    super(503, message);
  }
}
