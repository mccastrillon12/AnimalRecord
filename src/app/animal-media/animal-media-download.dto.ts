import { ApiProperty } from '@nestjs/swagger';
import type { AnimalMediaDownload } from '../../context/animal-media/domain/animal-media-download-storage';

export class AnimalMediaDownloadDto implements AnimalMediaDownload {
  @ApiProperty({ description: 'Temporary URL for reading the file' })
  downloadUrl: string;

  @ApiProperty({ description: 'Validity of the URL in seconds', example: 300 })
  expiresIn: number;
}
