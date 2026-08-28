export function invariant(condition,code,message,details){if(!condition){const error=new Error(message);error.code=code;error.details=details;throw error;}}
