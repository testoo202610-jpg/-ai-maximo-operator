import { config } from "../shared/config.ts";
import { BrowserConnector } from "./browser.ts";
import { RestConnector } from "./rest.ts";
import type { MaximoConnector } from "../domain/index.ts";
export function connector(): MaximoConnector {
  return config.MAXIMO_CONNECTOR_MODE === "rest"
    ? new RestConnector()
    : new BrowserConnector();
}
