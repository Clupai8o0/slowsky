// Thrown by lane stubs until the lane lands its module.
export class NotImplemented extends Error
{
    constructor(what: string)
    {
        super(`${what} is not built yet`);
        this.name = 'NotImplemented';
    }
}
