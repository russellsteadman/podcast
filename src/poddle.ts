#!/usr/bin/env node

import {
  PollyClient,
  SynthesizeSpeechCommandInput,
  SynthesizeSpeechCommand,
} from '@aws-sdk/client-polly';
import { writeFile } from 'fs/promises';
import { ensureDir, emptyDir, copy as copyFile, readJSON } from 'fs-extra/esm';
import ffmpegPath from 'ffmpeg-static';
import { v4 as uuid } from 'uuid';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { program } from 'commander';
import inquirer from 'inquirer';
import open from 'open';

const exec = promisify(execCallback);
const polly = new PollyClient({});

const POLLY_PRESETS: Partial<SynthesizeSpeechCommandInput> = {
  OutputFormat: 'ogg_vorbis',
  TextType: 'ssml',
  Engine: 'neural',
  SampleRate: '24000',
};

const POLLY_VOICES = {
  'en-US': [
    'Ivy',
    'Joanna',
    'Kendra',
    'Kimberly',
    'Salli',
    'Joey',
    'Justin',
    'Kevin',
    'Matthew',
    'Ruth',
    'Stephen',
  ],
  'fr-FR': ['Lea', 'Remi'],
  'de-DE': ['Vicki', 'Daniel'],
  'it-IT': ['Bianca', 'Adriano'],
  'ja-JP': ['Takumi', 'Kazuha', 'Tomoko'],
  'ko-KR': ['Seoyeon'],
  'pt-BR': ['Camila', 'Vitoria', 'Thiago'],
  'es-ES': ['Lucia', 'Sergio'],
  'es-MX': ['Mia', 'Andres'],
  'es-US': ['Lupe', 'Pedro'],
  'yue-CN': ['Hiujin'],
  'cmn-CN': ['Zhiyu'],
};

const pascalCase = (str: string) =>
  str
    .split(' ')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

const here = (path: string) =>
  join(dirname(fileURLToPath(import.meta.url)), path);
const there = (path: string) => join(process.cwd(), path);

const SILENCE = here('silence.ogg');

function shuffle(original: any[]) {
  const array = [...original];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
}

program
  .name('poddle')
  .description('Generate language podcasts')
  .version('0.1.0');

program
  .command('create')
  .description('Create a podcast from a JSON file')
  .argument('<file>', 'JSON file of podcast')
  .option('-H, --host <speaker>', 'The name of the AWS Polly host speaker')
  .option('-G, --guest <speaker>', 'The name of the AWS Polly guest speaker')
  .action(async (file, options: { host?: string; guest?: string }) => {
    // clear out old files
    await ensureDir(here('sound-temp'));
    await emptyDir(here('sound-temp'));
    await copyFile(SILENCE, here('sound-temp/silence.ogg'));

    // read in all json pods
    const podData: {
      title: string;
      set: [string, string][];
      lang: string;
      hostLang: string;
    } = await readJSON(there(file));
    const { title, set, lang, hostLang } = podData;

    // convert host and guest to pascal case if provided
    if (options.host) options.host = pascalCase(options.host);
    if (options.guest) options.guest = pascalCase(options.guest);

    // validate speaker names if provided
    if (
      options.host &&
      !POLLY_VOICES[
        (hostLang ?? 'en-US') as keyof typeof POLLY_VOICES
      ].includes(options.host)
    ) {
      console.error(`No speaker named "${options.host}" for ${hostLang}`);
      process.exit(1);
    } else if (
      options.guest &&
      !POLLY_VOICES[lang as keyof typeof POLLY_VOICES].includes(options.guest)
    ) {
      console.error(`No speaker named "${options.guest}" for ${lang}`);
      process.exit(1);
    }

    // if no speakers provided, ask if they want to open the documentation url
    if (!options.host || !options.guest) {
      const { shouldOpen } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldOpen',
          message: `Would you like to learn more about speaker voice options?`,
        },
      ]);
      if (shouldOpen) {
        await open(
          'https://docs.aws.amazon.com/polly/latest/dg/voicelist.html',
        );
      }
    }

    // ask for speaker names if not provided
    if (!options.host) {
      const choices =
        POLLY_VOICES[(hostLang ?? 'en-US') as keyof typeof POLLY_VOICES];
      if (choices.length === 1) {
        options.host = choices[0];
      } else {
        const { host } = await inquirer.prompt([
          {
            type: 'list',
            name: 'host',
            message: `Who should be the ${hostLang ?? 'en-US'} speaker?`,
            choices,
          },
        ]);
        options.host = host;
      }
    }

    if (!options.guest) {
      const choices = POLLY_VOICES[lang as keyof typeof POLLY_VOICES];
      if (choices.length === 1) {
        options.guest = choices[0];
      } else {
        const { guest } = await inquirer.prompt([
          {
            type: 'list',
            name: 'guest',
            message: `Who should be the ${lang} speaker?`,
            choices,
          },
        ]);
        options.guest = guest;
      }
    }

    console.log(`Generating audio for "${title}"...`);

    // identify phrase language
    const phrases: [boolean, string][] = [
      [true, title],
      [true, "Now it's time for a quiz! Say the following phrases in Spanish:"],
    ];
    for (const [learning, fluent] of set) {
      phrases.push([false, learning]);
      phrases.push([true, fluent]);
    }

    // generate audio clips
    const requests: Promise<Uint8Array>[] = [];
    for (const [i, [isHostLang, text]] of phrases.entries()) {
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 1000));
      const params = {
        ...POLLY_PRESETS,
        ...(isHostLang
          ? {
              VoiceId:
                options.host ??
                POLLY_VOICES[
                  (hostLang ?? 'en-US') as keyof typeof POLLY_VOICES
                ][0],
              LanguageCode: hostLang ?? 'en-US',
            }
          : {
              VoiceId:
                options.guest ??
                POLLY_VOICES[lang as keyof typeof POLLY_VOICES][0],
              LanguageCode: lang,
            }),
        Text: isHostLang
          ? `<speak>${text}<break /><break /></speak>`
          : `<speak><prosody rate="x-slow">${text}</prosody><break /></speak>`,
      } as SynthesizeSpeechCommandInput;
      requests.push(
        polly.send(new SynthesizeSpeechCommand(params)).then((res) => {
          if (!res.AudioStream) throw new Error('No audio stream');

          return res.AudioStream.transformToByteArray();
        }),
      );
    }

    const clips = await Promise.all(requests);

    // write audio clips to disk
    const clipPaths: string[] = [];
    for (const clip of clips) {
      const clipPath = here(`sound-temp/${uuid()}.ogg`);
      await writeFile(clipPath, clip);
      clipPaths.push(clipPath);
    }

    // stitch audio clips together
    const titlePath = clipPaths.shift() as string;
    const quizPath = clipPaths.shift() as string;

    const clipPairs = clipPaths.reduce((a, b, c) => {
      if (c % 2 === 1) {
        const d = a.pop() ?? [];
        a.push([d[0], b]);
      } else {
        a.push([b]);
      }
      return a;
    }, [] as string[][]);

    const fileList = [titlePath, SILENCE]
      .concat(...clipPairs.map(([es, en]) => [en, es, es, en, es, es, SILENCE]))
      .concat([quizPath, SILENCE])
      .concat(
        ...shuffle(clipPairs)
          .slice(0, 7)
          .map(([es, en]) => [en, SILENCE, SILENCE, es, SILENCE]),
      )
      .map((path) => `file '${path?.split('/').pop()}'`)
      .join('\n');

    const listFile = here(`sound-temp/${uuid()}.txt`);
    await writeFile(listFile, fileList);

    const outputPath = there(`${basename(file).replace('.json', '')}.ogg`);
    await exec(
      `${ffmpegPath} -f concat -safe 0 -i "${listFile}" -c libvorbis -filter:a "atempo=0.7" "${outputPath}"`,
    );

    console.log(`Podcast "${title}" saved to "${outputPath}"`);
  });

program
  .command('new')
  .description('Get a template for a new podcast')
  .argument('<name>', 'Name of the JSON file of podcast')
  .action(async (name) => {
    const nameStripped = name
      .replace(/\.json/i, '')
      .toLowerCase()
      .replace(/ /g, '-')
      .replace(/[^a-z0-9-_]/g, '');

    // copy template file
    await copyFile(here('pod-template.json'), there(`${nameStripped}.json`));

    // open file in editor
    await open(there(`${nameStripped}.json`));

    console.log(
      `New podcast "${name}" created at "${there(`${nameStripped}.json`)}"`,
    );
  });

await program.parseAsync();
