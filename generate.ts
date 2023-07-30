import {
  PollyClient,
  SynthesizeSpeechCommandInput,
  SynthesizeSpeechCommand,
} from "@aws-sdk/client-polly";
import fs from "fs-extra";
import ffmpegPath from "ffmpeg-static";
import { v4 as uuid } from "uuid";
import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);
const polly = new PollyClient({});

const POLLY_PRESETS: Partial<SynthesizeSpeechCommandInput> = {
  OutputFormat: "ogg_vorbis",
  TextType: "ssml",
  Engine: "neural",
  SampleRate: "24000",
};

const POLLY_PRESETS_EN: Partial<SynthesizeSpeechCommandInput> = {
  VoiceId: "Matthew",
  LanguageCode: "en-US",
};

const POLLY_PRESETS_ES: Partial<SynthesizeSpeechCommandInput> = {
  VoiceId: "Pedro",
  LanguageCode: "es-US",
};

const run = async () => {
  // clear out old files
  await fs.ensureDir("./pods");
  await fs.ensureDir("./sound-temp");
  await fs.emptyDir("./sound-temp");
  await fs.readdir("./pods").then((files) => {
    return Promise.all(
      files
        .filter((file) => file.endsWith(".ogg"))
        .map((file) => fs.remove(`./pods/${file}`))
    );
  });
  await fs.copyFile("./silence.ogg", "./sound-temp/silence.ogg");

  // get all pod files
  const pods = await fs.readdir("./pods");

  // read in all json pods
  for (const pod of pods) {
    const podData: { title: string; set: [string, string][] } =
      await fs.readJSON(`./pods/${pod}`);
    const { title, set } = podData;

    console.log(`Generating audio for "${title}"...`);

    // identify phrase language
    const phrases: ["en" | "es", string][] = [["en", title]];
    for (const [es, en] of set) {
      phrases.push(["es", es]);
      phrases.push(["en", en]);
    }

    // generate audio clips
    const requests: Promise<Uint8Array>[] = [];
    for (const [i, [lang, text]] of phrases.entries()) {
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 1000));
      const params = {
        ...POLLY_PRESETS,
        ...(lang === "en" ? POLLY_PRESETS_EN : POLLY_PRESETS_ES),
        Text:
          lang === "en"
            ? `<speak>${text}<break /><break /></speak>`
            : `<speak><prosody rate="x-slow">${text}</prosody><break /></speak>`,
      } as SynthesizeSpeechCommandInput;
      requests.push(
        polly.send(new SynthesizeSpeechCommand(params)).then((res) => {
          if (!res.AudioStream) throw new Error("No audio stream");

          return res.AudioStream.transformToByteArray();
        })
      );
    }

    const clips = await Promise.all(requests);

    // write audio clips to disk
    const clipPaths: string[] = [];
    for (const [i, [lang, text]] of phrases.entries()) {
      const clipPath = `./sound-temp/${uuid()}.ogg`;
      await fs.writeFile(clipPath, clips[i]);
      clipPaths.push(clipPath);
    }

    // stitch audio clips together
    const titlePath = clipPaths.shift() as string;

    const fileList = [titlePath, "silence.ogg"]
      .concat(
        ...clipPaths
          .reduce((a, b, c) => {
            if (c % 2 === 1) {
              const d = a.pop() ?? [];
              a.push([d[0], b]);
            } else {
              a.push([b]);
            }
            return a;
          }, [] as string[][])
          .map(([es, en]) => [en, es, es, en, es, es, "silence.ogg"])
      )
      .map((path) => `file '${path?.split("/").pop()}'`)
      .join("\n");

    const listFile = `./sound-temp/${uuid()}.txt`;
    await fs.writeFile(listFile, fileList);

    const outputPath = `./pods/${pod.replace(".json", "")}.ogg`;
    await exec(
      `${ffmpegPath} -f concat -i ${listFile} -c libvorbis -filter:a "atempo=0.7" ${outputPath}`
    );
  }
};

run();
