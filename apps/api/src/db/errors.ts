import { AppError } from '../http/errors.js';

export function mapPgError(error: any): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const code = error?.code;

  if (code === '55P03') {
    // Lock timeout
    return new AppError(503, 'busy', 'Database lock timeout. Please retry after a brief delay.', {
      retry_after_seconds: 1,
    });
  }

  if (code === '23505') {
    // Unique violation
    const constraint = error?.constraint;
    if (constraint === 'approvals_one_pending_uq') {
      return new AppError(409, 'invalid_transition', 'An approval request is already pending for this item.');
    }
    if (constraint === 'users_email_lower_uq') {
      return new AppError(409, 'conflict', 'A user with this email address already exists.');
    }
    if (constraint === 'teams_slug_uq') {
      return new AppError(409, 'conflict', 'A team with this slug already exists.');
    }
    return new AppError(409, 'conflict', 'Resource conflict or duplicate key violation.');
  }

  if (code === '23514') {
    // Check constraint violation
    return new AppError(500, 'internal', 'Database consistency constraint violation: ' + (error?.constraint || 'check_violation'));
  }

  if (code === 'P0001') {
    // Custom raise exception from trigger
    return new AppError(500, 'internal', error?.message || 'Database trigger exception');
  }

  return new AppError(500, 'internal', 'Database error occurred: ' + (error?.message || 'unknown'));
}
