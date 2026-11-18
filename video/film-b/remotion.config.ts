import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
Config.setConcurrency(3);
// Several agents may render at once; a shared webpack cache could be written by two of them together.
Config.setCachingEnabled(false);
