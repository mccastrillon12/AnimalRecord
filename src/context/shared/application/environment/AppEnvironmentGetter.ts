import { EnvironmentConfigService } from '../../infrastructure';

export class AppEnvironmentGetter {
  constructor(private environmentService: EnvironmentConfigService) {}
  run(): string | undefined {
    return this.environmentService.getAppEnv();
  }
}
