import Redis from 'ioredis';
import { Context } from './context';
import Audit from './audit';
import { InstanceDetails } from './instance_tracker';

export interface ShutdownManagerOptions {
    redisClient: Redis.Redis;
    shutdownTTL: number;
    audit: Audit;
}

export default class ShutdownManager {
    private redisClient: Redis.Redis;
    private shutdownTTL: number;
    private audit: Audit;

    constructor(options: ShutdownManagerOptions) {
        this.redisClient = options.redisClient;
        this.shutdownTTL = options.shutdownTTL;
        this.audit = options.audit;
    }

    shutDownKey(instanceId: string): string {
        return `instance:shutdown:${instanceId}`;
    }

    protectedKey(instanceId: string): string {
        return `instance:scaleDownProtected:${instanceId}`;
    }

    reconfigureKey(instanceId: string): string {
        return `instance:reconfigure:${instanceId}`;
    }

    async setReconfigureStatus(
        ctx: Context,
        instanceDetails: Array<InstanceDetails>,
        status = <string>null,
    ): Promise<boolean> {
        if (status == null) {
            status = new Date().toUTCString();
        }
        const pipeline = this.redisClient.pipeline();
        for (const instance of instanceDetails) {
            const key = this.reconfigureKey(instance.instanceId);
            ctx.logger.debug('Writing reconfigure status', { key, status });
            pipeline.set(key, status, 'ex', this.shutdownTTL);
        }
        await pipeline.exec();
        await this.audit.saveReconfigureEvents(instanceDetails);
        return true;
    }

    async unsetReconfigureStatus(ctx: Context, instanceId: string, group: string): Promise<boolean> {
        const key = this.reconfigureKey(instanceId);
        const res = await this.redisClient.del(key);
        ctx.logger.debug('Remove reconfigure value', { key, res });
        await this.audit.saveUnsetReconfigureEvents(instanceId, group);
        return true;
    }

    async getReconfigureValues(ctx: Context, instanceIds: Array<string>): Promise<string[]> {
        const pipeline = this.redisClient.pipeline();
        instanceIds.forEach((instanceId) => {
            const key = this.reconfigureKey(instanceId);
            pipeline.get(key);
        });
        const instances = await pipeline.exec();
        return instances.map((instance: any) => {
            return instance[1];
        });
    }

    async getReconfigureValue(ctx: Context, instanceId: string): Promise<string> {
        const key = this.reconfigureKey(instanceId);
        const res = await this.redisClient.get(key);
        ctx.logger.debug('Read reconfigure value', { key, res });
        return res;
    }

    async getReconfigureStatus(ctx: Context, instanceId: string): Promise<boolean> {
        const res = await this.getReconfigureValue(ctx, instanceId);
        return res !== null;
    }

    async setShutdownStatus(
        ctx: Context,
        instanceDetails: Array<InstanceDetails>,
        status = 'shutdown',
    ): Promise<boolean> {
        const pipeline = this.redisClient.pipeline();
        for (const instance of instanceDetails) {
            const key = this.shutDownKey(instance.instanceId);
            ctx.logger.debug('Writing shutdown status', { key, status });
            pipeline.set(key, status, 'ex', this.shutdownTTL);
        }
        await pipeline.exec();
        await this.audit.saveShutdownEvents(instanceDetails);
        return true;
    }

    async getShutdownStatuses(ctx: Context, instanceIds: Array<string>): Promise<boolean[]> {
        const pipeline = this.redisClient.pipeline();
        instanceIds.forEach((instanceId) => {
            const key = this.shutDownKey(instanceId);
            pipeline.get(key);
        });
        const instances = await pipeline.exec();
        return instances.map((instance: string[]) => {
            return instance[1] == 'shutdown';
        });
    }

    async getShutdownStatus(ctx: Context, instanceId: string): Promise<boolean> {
        const key = this.shutDownKey(instanceId);
        const res = await this.redisClient.get(key);
        ctx.logger.debug('Read shutdown status', { key, res });
        return res == 'shutdown';
    }

    async setScaleDownProtected(
        ctx: Context,
        instanceId: string,
        protectedTTL: number,
        mode = 'isScaleDownProtected',
    ): Promise<boolean> {
        const key = this.protectedKey(instanceId);
        ctx.logger.debug('Writing protected mode', { key, mode });
        await this.redisClient.set(key, mode, 'ex', protectedTTL);
        return true;
    }

    async areScaleDownProtected(ctx: Context, instanceIds: Array<string>): Promise<boolean[]> {
        const pipeline = this.redisClient.pipeline();
        instanceIds.forEach((instanceId) => {
            const key = this.protectedKey(instanceId);
            pipeline.get(key);
        });
        const instances = await pipeline.exec();
        return instances.map((instance: string[]) => {
            return instance[1] == 'isScaleDownProtected';
        });
    }
}
