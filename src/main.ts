import "./styles.css";

import { HeadTrackedSpaceApp } from "./app";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Unable to find #app root element.");
}

const app = new HeadTrackedSpaceApp(root);

void app.mount();
