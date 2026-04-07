const fs = require("fs");
const path = require("path");

// Auto-discover all profile YAML files and create one pm2 app per profile
const profilesDir = path.join(__dirname, "config", "profiles");
const profiles = fs.existsSync(profilesDir)
  ? fs.readdirSync(profilesDir).filter((f) => f.endsWith(".yaml"))
  : [];

module.exports = {
  apps: profiles.map((file) => {
    const name = path.basename(file, ".yaml");
    const profilePath = path.join("config", "profiles", file);
    return {
      name: name,
      script: "src/daemon.ts",
      args: `--profile=${profilePath}`,
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
    };
  }),
};
