// Shared constants for the MCP tool surface (schema definitions and handler
// validation both need these, so they live in one place with no other
// dependencies to avoid import cycles between tools.mjs and handlers.mjs).

export const ADAPTERS = ['generic', 'codex', 'gajae', 'ouroboros', 'omo'];

export const emptyObjectSchema = Object.freeze({ type: 'object', properties: {}, additionalProperties: false });
