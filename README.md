# UW Sidequest

[![Chrome ZIP](https://img.shields.io/badge/Chrome-download%20ZIP-4285F4?logo=googlechrome&logoColor=white)](https://github.com/hhhapz/sidequest/releases/download/v0.2.0/sidequest-v0.2.0.zip)
[![Firefox XPI](https://img.shields.io/badge/Firefox-install%20XPI-FF7139?logo=firefoxbrowser&logoColor=white)](https://github.com/hhhapz/sidequest/releases/download/v0.2.0/sidequest-v0.2.0.xpi)

A Browser extension Chrome and Firefox that adds Instructor, Room and Status information to the Course Schedule table on [uwflow.com](https://uwflow.com).

It also replaces Quest's class search with its own: one search box with autocomplete for courses, subjects and instructors, multiple courses at once (`CS 246, MATH 239`), whole levels (`CS 2`), UW Flow ratings, enrolment, requisites and reviews, and an instructor's teaching history. Each feature can be turned off in the extension's settings.

This extension uses your own signed-in UW Quest session, you must be able to access sensitive class information to see it within Quest.

![UW Sidequest adding Quest details to the UW Flow course schedule](assets/sidequest-screenshot.png)

## Installation

### Chrome

1. Download the extension archive:

   [![Chrome ZIP](https://img.shields.io/badge/Chrome-download%20ZIP-4285F4?logo=googlechrome&logoColor=white)](https://github.com/hhhapz/sidequest/releases/download/v0.2.0/sidequest-v0.2.0.zip)

2. Unzip it.
3. Open `chrome://extensions`.
4. Turn on Developer mode.
5. Click Load unpacked and select the unzipped folder containing `manifest.json`.

### Firefox 140 or newer

Clicky:

[![Firefox XPI](https://img.shields.io/badge/Firefox-install%20XPI-FF7139?logo=firefoxbrowser&logoColor=white)](https://github.com/hhhapz/sidequest/releases/download/v0.2.0/sidequest-v0.2.0.xpi)


## Why?

A few years back, the UW public class API removed instructor and room information from the public. This brings back that information without making it accessible to anyone who doesn't already have that information.
