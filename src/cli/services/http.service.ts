import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { got } from 'got';
import hasha from 'hasha';
import { inject, injectable } from 'inversify';
import { logger } from '../utils';
import { EnvService } from './env.service';
import { PathService } from './path.service';

export type HttpChecksumType =
  | 'sha1'
  | 'sha224'
  | 'sha256'
  | 'sha384'
  | 'sha512';

export interface HttpDownloadConfig {
  url: string;
  expectedChecksum?: string;
  checksumType?: HttpChecksumType;
  fileName?: string;
}

@injectable()
export class HttpService {
  constructor(
    @inject(EnvService) private envSvc: EnvService,
    @inject(PathService) private pathSvc: PathService
  ) {}

  async download({
    url,
    expectedChecksum,
    checksumType,
    fileName,
  }: HttpDownloadConfig): Promise<string> {
    const urlChecksum = hasha(url, { algorithm: 'sha256' });

    const cacheDir = this.envSvc.cacheDir ?? this.pathSvc.tmpDir;
    const cachePath = join(cacheDir, urlChecksum);
    // TODO: validate name
    const file = fileName ?? new URL(url).pathname.split('/').pop()!;
    const filePath = join(cachePath, file);

    if (await this.pathSvc.fileExists(filePath)) {
      if (expectedChecksum && checksumType) {
        const actualChecksum = await hasha.fromFile(filePath, {
          algorithm: checksumType,
        });

        if (actualChecksum === expectedChecksum) {
          return filePath;
        } else {
          logger.debug(
            { url, expectedChecksum, actualChecksum, checksumType },
            'checksum mismatch'
          );
        }
      } else {
        return filePath;
      }
    }

    await mkdir(cachePath, { recursive: true });

    for (const run of [1, 2, 3]) {
      try {
        await pipeline(got.stream(url), createWriteStream(filePath));
        return filePath;
      } catch (err) {
        if (run === 3) {
          logger.error({ err, run }, 'download failed');
        } else {
          logger.debug({ err, run }, 'download failed');
        }
      }
    }
    throw new Error('download failed');
  }
}