import { z } from 'zod';

export function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    try {
      if (body) {
        req.body = body.parse(req.body);
      }
      if (query) {
        req.query = query.parse(req.query);
      }
      if (params) {
        req.params = params.parse(req.params);
      }
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: err.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      next(err);
    }
  };
}

export function paginationQuerySchema(defaultLimit = 50, maxLimit = 200) {
  return z.object({
    limit: z
      .string()
      .optional()
      .transform((val) => (val ? Math.min(Math.max(1, parseInt(val, 10) || defaultLimit), maxLimit) : defaultLimit)),
    offset: z
      .string()
      .optional()
      .transform((val) => (val ? Math.max(0, parseInt(val, 10) || 0) : 0)),
  });
}
