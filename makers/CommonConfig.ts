import { Configuration } from "app-builder-lib";

// The copyright line in the installer's and the app's file properties.
// Without it, electron-builder writes "Copyright © <year> <package.json
// author>", which would drop the original author now that the author is
// lukethehawk (the publisher Windows lists for the program).
export const COPYRIGHT = "Copyright © Aman Harwara (Altus) and lukethehawk (Altus +)";

export const CommonConfig: Partial<Configuration> = {
  appId: "com.lukethehawk.altusplus",
  productName: "Altus +",
  copyright: COPYRIGHT,
  // Deliberately do not register the whatsapp:// protocol.
};
