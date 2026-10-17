import type {AcousticInferenceInput,AcousticInferencePort} from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/inference-types';

/** Independent replay recordings reset their local planner, not the one shared Worker's job sequence. */
export class SharedWorkerJobs {
  private nextJob=0;
  constructor(private readonly worker:AcousticInferencePort){}
  run(input:AcousticInferenceInput){
    const jobIndex=this.nextJob++;
    return this.worker.run({window:{...input.window,jobIndex},pcm:input.pcm});
  }
  get submittedJobs(){return this.nextJob;}
}
