declare module "mjml" {
  interface MjmlError {
    line: number;
    message: string;
    tagName: string;
    formattedMessage: string;
  }
  interface MjmlOptions {
    validationLevel?: "strict" | "soft" | "skip";
    keepComments?: boolean;
    minify?: boolean;
  }
  export default function mjml2html(
    mjml: string,
    options?: MjmlOptions,
  ): Promise<{ html: string; errors: MjmlError[] }>;
}
