module.exports = {
  apps: [
    {
      name: "clutchbet",
      script: "src/daemon.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
