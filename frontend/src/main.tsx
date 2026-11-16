import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import { bootstrap } from "./bootstrap";

const root = document.getElementById("root");
if (root) {
  bootstrap(root, { rawApiBaseUrl: import.meta.env.VITE_API_BASE_URL as string | undefined });
}
