# Poddle

Poddle is a simple CLI-based podcast generator. It uses a JSON podcast file, such as the ones in the `examples/` folder, to generate a simple "listen-and-repeat" style language learning podcast.

## Prerequisites

Poddle uses AWS Polly for text-to-speech generation. Poddle requires that you have an AWS account with access to the Polly service. You will need to create an IAM user with access to Polly and generate an access key and secret key. Use the [AWS CLI](https://aws.amazon.com/cli/) and run `aws configure` to set up your credentials.

## Installation

```sh
npx poddle@latest [COMMAND] [OPTIONS]
```

Poddle can be globally installed as well.

```sh
npm install -g poddle
```

## Commands

### `create`

Simply provide the file formatted with the poddle json schema. The `create` command will automatically prompt you for which voices to use for the podcast. You can also specify the voices using the `-H` and `-G` flags.

```text
Usage: poddle create [options] <file>

Create a podcast from a JSON file

Arguments:
  file                   JSON file of podcast

Options:
  -H, --host <speaker>   The name of the AWS Polly host speaker
  -G, --guest <speaker>  The name of the AWS Polly guest speaker
  -h, --help             display help for command
```

## License

&copy; 2023 [MIT](./LICENSE) Russell Steadman
