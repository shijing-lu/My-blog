import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";
await Promise.all([
  loadFont({ family: "WenKai", url: staticFile("fonts/WenKai.ttf") }),
  loadFont({
    family: "Lora",
    url: staticFile("fonts/Lora.woff2"),
    weight: "700",
  }),
  loadFont({ family: "BlogPixel", url: staticFile("fonts/Pixel.woff2") }),
]);
