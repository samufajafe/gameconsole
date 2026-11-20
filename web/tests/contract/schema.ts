import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from './event.schema.json';

/**
 * Validador del sobre de evento con la COPIA de `gamestats/contracts/event.schema.json`.
 * Si P1 cambia su contrato, se vuelve a copiar el archivo y estas pruebas dicen que hay que tocar.
 */
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

export const validateEvent = ajv.compile(schema);

export function schemaErrors(event: unknown): string {
  return validateEvent(event) ? '' : ajv.errorsText(validateEvent.errors);
}
