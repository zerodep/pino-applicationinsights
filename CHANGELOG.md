# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.0.1] - 2024-05-20

- peer bump `pino-abstract-transport@2` since it dropped one dependency, but for some reason it keeps all files in the entire github project, as do split2, and pino, all adding up to lots of unneccessary files being zipped and deployed to azure, deploy time to azure is correlated to number of files deployed, not to mention [applicationinsights@3](https://bundlephobia.com/package/applicationinsights), what happened between 2 and 3? END RANT
- `dts-buddy` touched typings, adding an empty export object at the end of namespace, might be important

## [1.0.0] - 2024-05-20

In production, and has been for a while.

- use prettier for formatting rules
- use [texample](https://www.npmjs.com/package/texample) to run through README examples, unsuccessfully I might add. No syntax errors but not running through

## [0.1.2] - 2023-11-16

- fix naive implementation of fake expect function, not sure what it did before
- redecorate some typing

## [0.1.1] - 2023-11-13

- make track function optional in typescript as well

## [0.1.0] - 2023-11-13

First version worth mentioning.

- make track function optional in typescript as well
- track function defaults to tracking trace and exception
