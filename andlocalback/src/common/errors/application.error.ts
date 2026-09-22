export class ApplicationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /* 403 para «esto existe y es tuyo, pero esta operacion no la haces tu».
       No confundir con el 404 que devuelve AssertManagerScope para lo ajeno:
       alli el 403 confirmaria que el registro existe y de quien es. */
    public readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}
