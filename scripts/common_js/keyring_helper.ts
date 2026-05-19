import { setPassword, getPassword, deletePassword } from "cross-keychain";
import { NAME_SPACE } from "./GUOHUB_CLI_CONFIG.js";

export async function getCredential(name: string) {
  return await getPassword(NAME_SPACE, name);
}

export async function setCredential(name: string, value: string) {
  await setPassword(NAME_SPACE, name, value);
}

export async function deleteCredential(name: string) {
  await deletePassword(NAME_SPACE, name);
}
