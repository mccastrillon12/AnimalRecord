import { Controller, Get } from '@nestjs/common';

@Controller('.well-known')
export class MobileController {
    @Get('assetlinks.json')
    getAssetLinks() {
        return [
            {
                relation: ['delegate_permission/common.handle_all_urls'],
                target: {
                    namespace: 'android_app',
                    package_name: 'com.animalRecord.animal_record',
                    sha256_cert_fingerprints: [
                        '7A:3D:67:F7:EF:C7:B9:EA:4C:B8:81:20:5B:31:3F:74:CC:2D:56:FB:7D:02:9E:86:3F:2A:14:9B:91:1C:FC:16',
                    ],
                },
            },
        ];
    }
}
