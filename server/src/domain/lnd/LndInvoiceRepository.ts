import { AppInvoice } from "../AppInvoice";
import { CreateInvoiceResult } from "../CreateInvoiceResult";
import { ILndRpcClient } from "./ILndRpcClient";
import { Lnd } from "./v0.12.1-beta/Types";

export type InvoiceHandler = (invoice: AppInvoice) => void;

export class LndInvoiceRepository {
    public cache: Map<string, Lnd.Invoice>;
    public handlers: Set<InvoiceHandler>;

    constructor(readonly client: ILndRpcClient) {
        this.cache = new Map();
        this.handlers = new Set();
    }

    public addHandler(handler: InvoiceHandler) {
        this.handlers.add(handler);
    }

    /**
     *
     * @returns
     */
    public async addInvoice(
        valueMsat: number,
        memo: string,
        preimage: Buffer,
    ): Promise<CreateInvoiceResult> {
        try {
            const invoice = await this.client.addInvoice({
                amt_msat: valueMsat,
                memo,
                preimage,
            });
            return {
                success: true,
                paymentRequest: invoice.payment_request,
            };
        } catch (ex) {
            return {
                success: false,
                error: ex.message,
            };
        }
    }

    /**
     * This method looks up invoices from the LND invoice database filtering
     * to only those that match our application
     * @returns
     */
    public async sync(): Promise<void> {
        // subscribe to all new invoices/settlements
        void this.client.subscribeInvoices(invoice => {
            void this.processInvoice(invoice);
        }, {});

        // fetch
        const num_max_invoices = "1000";
        let index_offset: string = undefined;
        let cont = true;
        while (cont) {
            const results = await this.client.listInvoices({ index_offset, num_max_invoices });

            for (const invoice of results.invoices) {
                await this.processInvoice(invoice);
            }
            index_offset = (Number(results.last_index_offset) + 1).toString();

            cont = results.first_index_offset === results.last_index_offset;
        }
    }

    protected async processInvoice(invoice: Lnd.Invoice): Promise<void> {
        // update the cache
        this.cache.set(invoice.r_hash.toString("hex"), invoice);

        // convert lnd invoice into AppInvoice
        const appInvoice: AppInvoice = {
            memo: invoice.memo,
            preimage: invoice.r_preimage?.toString("hex"),
            hash: invoice.r_hash.toString("hex"),
            valueMsat: invoice.value_msat,
            settled: invoice.settled,
        };

        // emit to all async event handlers
        for (const handler of this.handlers) {
            await handler(appInvoice);
        }
    }
}